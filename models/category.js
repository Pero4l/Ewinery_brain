'use strict';

/** Product category (e.g. Red Wine, Whisky, Champagne). */
module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define('Category', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: { msg: 'A category with this name already exists' },
      validate: { notEmpty: { msg: 'Category name is required' } }
    },
    slug: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: { msg: 'A category with this slug already exists' }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    imageUrl: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    imagePublicId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Cloudinary public_id, required to delete/replace the asset'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    }
  }, {
    tableName: 'categories',
    paranoid: true,
    indexes: [
      { unique: true, fields: ['slug'] },
      { fields: ['isActive'] }
    ]
  });

  Category.associate = models => {
    Category.hasMany(models.Product, { foreignKey: 'categoryId', as: 'products' });
  };

  return Category;
};
