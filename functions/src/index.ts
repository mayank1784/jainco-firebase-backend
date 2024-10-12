import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";

import { client } from "./algoliaSearch";

import { error } from "firebase-functions/logger";

// Initialize Firebase Admin SDK
admin.initializeApp();
const firestore = admin.firestore();

type CategoryWithProducts = {
  id: string;
  image: string;
  name: string;
  description: string;
  products: Record<string,string>[];
};

export const createadmin = functions.https.onCall(async (data, context) => {
  // Check if user has admin privilege
  if (!context.auth?.token.admin) {
    return { message: "Unauthorized to create admin users" };
  }

  const auth = admin.auth();
  let userRecord: admin.auth.UserRecord | undefined;
  const userRef = firestore.collection("users").doc();

  try {
    // Extract user data
    const { name, email, mobileNo, password } = data;

    // Create user with email and password
    userRecord = await auth.createUser({
      email,
      password,
      emailVerified: false, // Set to false if email verification is required
    });
    const userRef = firestore.collection("users").doc(userRecord.uid);
    // Create user document in Firestore with a Promise
    const createUserDocPromise = userRef.set({
      name,
      email,
      mobileNo,
      role: "admin",
    });

    // Set custom claims for the newly created user after Firestore op completes
    await Promise.all([
      createUserDocPromise,
      auth.setCustomUserClaims(userRecord.uid, { admin: true }),
    ]);

    return { message: "User created successfully!" };
  } catch (error) {
    console.error("Error creating user:", error);

    // Rollback steps on error
    const rollbackError = "Error rolling back user creation.";

    // Attempt to delete the user (if created)
    try {
      if (userRecord) {
        await auth.deleteUser(userRecord.uid);
      }
    } catch (deleteError) {
      console.error("Error deleting user:", deleteError);
      return { error: rollbackError + " " + (deleteError as Error).message };
    }

    // Attempt to delete the Firestore document (if created)
    try {
      await userRef.delete();
    } catch (deleteError) {
      console.error("Error deleting user document:", deleteError);
      return { error: rollbackError + " " + (deleteError as Error).message };
    }

    return { error: (error as Error).message }; // Return original error if rollback fails
  }
});

// Cloud Function to fetch products by category with specific fields
export const fetchProductsByCategory = functions.https.onCall(
  async (data, context) => {
    try {
      const categoryId: string | null = data.categoryId || null;

      // Check if categoryId is null or empty
      if (!categoryId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Category ID is required."
        );
      }

      // Reference to the "products" collection
      const productsRef = firestore.collection("products");

      // Query for products with the specified category, selecting only specific fields
      const querySnapshot = await productsRef
        .where("category", "==", categoryId)
        .select(
          "name",
          "lowerPrice",
          "upperPrice",
          "mainImage",
          "description",
          "variationTypes"
        ) // Select only the necessary fields
        .get();

      if (querySnapshot.empty) {
        return {
          products: [],
          message: "No products found for this category.",
        };
      }

      // Extract only the specific fields
      const productList = querySnapshot.docs.map((doc) => {
        const data = doc.data();

        let variation: string[] = [];

        if (
          data.variationTypes &&
          Object.keys(data.variationTypes).length > 0
        ) {
          for (const value of Object.values(data.variationTypes)) {
            if (Array.isArray(value)) {
              variation = [...variation, ...value];
            }
          }
        }

        const dataToReturn = {
          id: doc.id,
          name: data.name,
          lowerPrice: data.lowerPrice,
          upperPrice: data.upperPrice,
          mainImage: data.mainImage,
          description: data.description,
          ...(variation.length > 0 && { variationTypes: variation.join(", ") }),
        };

        return dataToReturn;
      });

      return { products: productList };
    } catch (error) {
      console.error("Error fetching products:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to fetch products"
      );
    }
  }
);

export const syncProductsToAlgolia = functions.firestore
  .document("/products/{productId}")
  .onWrite(async (change, context) => {
    const productId = context.params.productId;
    const product = change.after.exists ? change.after.data() : null;
    const indexName = "products";

    if (product) {
      if (product.otherImages) {
        delete product.otherImages;
      }
      if (product.variationTypes) {
        const variationObject = product.variationTypes;
        product.variationTypes = [];
        for (const [_, value] of Object.entries(variationObject)) {
          if (Array.isArray(value)) {
            product.variationTypes = [...product.variationTypes, ...value];
          }
        }
      }
      const categoryRef = firestore
        .collection("categories")
        .doc(product.category);
      const categoryDoc = await categoryRef.get();

      // Check if the category document exists
      if (categoryDoc.exists) {
        const categoryData = categoryDoc.data();
        if (categoryData) {
          const categoryName = categoryData.name;
          product.category = categoryName;
        }
      }

      try {
        const { taskID } = await client.saveObject({
          indexName,
          body: { objectID: productId, ...product },
        });
        await client.waitForTask({
          indexName,
          taskID,
        });
      } catch (error) {
        console.log(error);
      }
    } else {
      console.log("error outside algolia: ", error);
    }
  });

// export const fetchCategoriesWithProductNames = functions.https.onCall(
//   async (data, context) => {
//     try {
//       // Step 1: Fetch all categories
//       const categoriesSnapshot = await firestore.collection("categories").get();

//       if (categoriesSnapshot.empty) {
//         return {
//           categories: [],
//           message: "No categories found.",
//         };
//       }

//       // Step 2: Initialize an array to store categories with product names
//       const categoriesWithProducts: CategoryWithProducts[] = [];

//       // Step 3: Iterate over each category and fetch associated product names
//       for (const categoryDoc of categoriesSnapshot.docs) {
//         const categoryData = categoryDoc.data();
//         const categoryId = categoryDoc.id;

//         // Fetch products under the current category, selecting only the name field
//         const productsSnapshot = await firestore
//           .collection("products")
//           .where("category", "==", categoryId)
//           .select("name")
//           .get();

//         // Extract product names
//         const productNames = productsSnapshot.docs.map((doc) => {
//           const productData = doc.data();
//           return {id: doc.id,
//             name: productData.name};
//         });

//         // Step 4: Store the category and its associated product names
//         categoriesWithProducts.push({
//           id:categoryId,
//           image: categoryData.image,
//           name: categoryData.name,
//           description: categoryData.description,
//           products: productNames
//         });
//       }

//       // Step 5: Return the structured categories with product names
//       return { categories: categoriesWithProducts };
//     } catch (error) {
//       console.error("Error fetching categories with products:", error);
//       throw new functions.https.HttpsError(
//         "internal",
//         "Failed to fetch categories with products"
//       );
//     }
//   }
// );

export const fetchCategoriesWithProductNames = functions.https.onCall(
  async (data, context) => {
    try {
      // Step 1: Check if a categoryId is passed as a parameter
      const categoryId = data?.categoryId || null;

      // Step 2: Initialize an array to store categories with product names
      const categoriesWithProducts: CategoryWithProducts[] = [];

      // Step 3: Fetch categories based on whether a categoryId is provided
      let categoriesSnapshot;

      if (categoryId) {
        // Fetch only the category with the specified categoryId
        const categoryDoc = await firestore.collection("categories").doc(categoryId).get();
        
        if (!categoryDoc.exists) {
          return {
            categories: [],
            message: "Category not found.",
          };
        }

        // Get category data
        const categoryData = categoryDoc.data();

        // Fetch products under the current category, selecting only the name field
        const productsSnapshot = await firestore
          .collection("products")
          .where("category", "==", categoryId)
          .select("name")
          .get();

        // Extract product names
        const productNames = productsSnapshot.docs.map((doc) => {
          const productData = doc.data();
          return {
            id: doc.id,
            name: productData.name,
          };
        });

        // Store the category and its associated product names
        categoriesWithProducts.push({
          id: categoryDoc.id,
          image: categoryData?.image,
          name: categoryData?.name,
          description: categoryData?.description,
          products: productNames,
        });
      } else {
        // Fetch all categories
        categoriesSnapshot = await firestore.collection("categories").get();

        if (categoriesSnapshot.empty) {
          return {
            categories: [],
            message: "No categories found.",
          };
        }

        // Step 4: Iterate over each category and fetch associated product names
        for (const categoryDoc of categoriesSnapshot.docs) {
          const categoryData = categoryDoc.data();
          const categoryId = categoryDoc.id;

          // Fetch products under the current category, selecting only the name field
          const productsSnapshot = await firestore
            .collection("products")
            .where("category", "==", categoryId)
            .select("name")
            .get();

          // Extract product names
          const productNames = productsSnapshot.docs.map((doc) => {
            const productData = doc.data();
            return {
              id: doc.id,
              name: productData.name,
            };
          });

          // Store the category and its associated product names
          categoriesWithProducts.push({
            id: categoryId,
            image: categoryData.image,
            name: categoryData.name,
            description: categoryData.description,
            products: productNames,
          });
        }
      }

      // Step 5: Return the structured categories with product names
      return { categories: categoriesWithProducts, message: "Success" };
    } catch (error) {
      console.error("Error fetching categories with products:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to fetch categories with products"
      );
    }
  }
);
